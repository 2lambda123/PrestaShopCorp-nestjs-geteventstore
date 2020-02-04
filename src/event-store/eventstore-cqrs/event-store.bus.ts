import { IEvent } from '@nestjs/cqrs';
import { BehaviorSubject, Observable, of, ReplaySubject, Subject } from 'rxjs';
import {
  EventData,
  createEventData,
  EventStorePersistentSubscription,
  ResolvedEvent,
  EventStoreCatchUpSubscription,
  PersistentSubscriptionNakEventAction,
} from 'node-eventstore-client';
import { v4 } from 'uuid';
import { Logger } from '@nestjs/common';
import { EventStore } from '../event-store.class';
import {
  EventStoreBusConfig,
  EventStoreSubscriptionType,
  EventStorePersistentSubscription as ESPersistentSubscription,
  EventStoreCatchupSubscription as ESCatchUpSubscription,
} from './event-bus.provider';

export interface IEventConstructors {
  [key: string]: (...args: any[]) => IEvent;
}

interface ExtendedCatchUpSubscription extends EventStoreCatchUpSubscription {
  isLive: boolean | undefined;
}

interface ExtendedPersistentSubscription
  extends EventStorePersistentSubscription {
  isLive: boolean | undefined;
}

// Todo Define
export class EventStoreEvent implements IEvent {
  data;
  meta;
  eventId;
  eventType;
  eventStreamId;
  created;
  eventNumber;
  constructor(
    data,
    meta,
    eventStreamId,
    eventType,
    eventId,
    created,
    eventNumber,
  ) {
    this.data = data;
    this.meta = meta;
    this.eventId = eventId;
    this.eventType = eventType;
    this.eventStreamId = eventStreamId;
    this.created = created;
    this.eventNumber = eventNumber;
  }
  getEventId() {
    return this.eventId;
  }

  getEventType() {
    return this.eventType;
  }

  getStream() {
    return this.eventStreamId;
  }

  getStreamCategory() {
    return this.eventStreamId.split('-')[0];
  }

  getStreamId() {
    return this.eventStreamId.replace(/^[^-]*-/, '');
  }
}

export class AcknowledgableEventstoreEvent extends EventStoreEvent {
  private originalEvent;
  private subscription: EventStorePersistentSubscription;
  constructor(
    data,
    meta,
    eventStreamId,
    eventType,
    eventId,
    created,
    eventNumber,
  ) {
    super(data, meta, eventStreamId, eventType, eventId, created, eventNumber);
    this.originalEvent = {
      eventId,
    };
  }
  setSubscription(sub: EventStorePersistentSubscription) {
    this.subscription = sub;
  }
  ack() {
    this.subscription.acknowledge(this.originalEvent);
  }
  nack(action: PersistentSubscriptionNakEventAction, reason: string) {
    this.subscription.fail(this.originalEvent, action, reason);
  }
}

export class EventStoreBus {
  private eventConstructors: IEventConstructors;
  private logger = new Logger('EventStoreBus');
  private catchupSubscriptions: ExtendedCatchUpSubscription[] = [];
  private catchupSubscriptionsCount: number;

  private persistentSubscriptions: ExtendedPersistentSubscription[] = [];
  private persistentSubscriptionsCount: number;

  constructor(
    private eventStore: EventStore,
    private subject$: Subject<IEvent>,
    config: EventStoreBusConfig,
  ) {
    this.addEventHandlers(config.eventInstantiators);

    const catchupSubscriptions = config.subscriptions.filter(sub => {
      return sub.type === EventStoreSubscriptionType.CatchUp;
    });

    const persistentSubscriptions = config.subscriptions.filter(sub => {
      return sub.type === EventStoreSubscriptionType.Persistent;
    });

    this.subscribeToCatchUpSubscriptions(
      catchupSubscriptions as ESCatchUpSubscription[],
    );

    this.subscribeToPersistentSubscriptions(
      persistentSubscriptions as ESPersistentSubscription[],
    );
  }

  async subscribeToPersistentSubscriptions(
    subscriptions: ESPersistentSubscription[],
  ) {
    this.persistentSubscriptionsCount = subscriptions.length;
    this.persistentSubscriptions = await Promise.all(
      subscriptions.map(async subscription => {
        return await this.subscribeToPersistentSubscription(
          subscription.stream,
          subscription.persistentSubscriptionName,
        );
      }),
    );
  }

  subscribeToCatchUpSubscriptions(subscriptions: ESCatchUpSubscription[]) {
    this.catchupSubscriptionsCount = subscriptions.length;
    this.catchupSubscriptions = subscriptions.map(subscription => {
      return this.subscribeToCatchupSubscription(subscription.stream);
    });
  }

  get allCatchUpSubscriptionsLive(): boolean {
    const initialized =
      this.catchupSubscriptions.length === this.catchupSubscriptionsCount;
    return (
      initialized &&
      this.catchupSubscriptions.every(subscription => {
        return !!subscription && subscription.isLive;
      })
    );
  }

  get allPersistentSubscriptionsLive(): boolean {
    const initialized =
      this.persistentSubscriptions.length === this.persistentSubscriptionsCount;
    return (
      initialized &&
      this.persistentSubscriptions.every(subscription => {
        return !!subscription && subscription.isLive;
      })
    );
  }

  get isLive(): boolean {
    return (
      this.allCatchUpSubscriptionsLive && this.allPersistentSubscriptionsLive
    );
  }

  async publish(event: IEvent, stream?: string) {
    const payload: EventData = createEventData(
      v4(),
      event.constructor.name,
      true,
      Buffer.from(JSON.stringify(event)),
    );

    try {
      await this.eventStore.connection.appendToStream(stream, -2, [payload]);
    } catch (err) {
      this.logger.error(err);
    }
  }

  subscribeToCatchupSubscription(stream: string): ExtendedCatchUpSubscription {
    this.logger.log(`Catching up and subscribing to stream ${stream}!`);
    try {
      return this.eventStore.connection.subscribeToStreamFrom(
        stream,
        0,
        true,
        (sub, payload) => this.onEvent(sub, payload),
        subscription =>
          this.onLiveProcessingStarted(
            subscription as ExtendedCatchUpSubscription,
          ),
        (sub, reason, error) =>
          this.onDropped(sub as ExtendedCatchUpSubscription, reason, error),
      ) as ExtendedCatchUpSubscription;
    } catch (err) {
      this.logger.error(err.message);
    }
  }

  async subscribeToPersistentSubscription(
    stream: string,
    subscriptionName: string,
  ): Promise<ExtendedPersistentSubscription> {
    try {
      this.logger.log(`
      Connecting to persistent subscription ${subscriptionName} on stream ${stream}!
      `);
      const resolved = (await this.eventStore.connection.connectToPersistentSubscription(
        stream,
        subscriptionName,
        (sub, payload) => this.onEvent(sub, payload),
        (sub, reason, error) =>
          this.onDropped(sub as ExtendedPersistentSubscription, reason, error),
      )) as ExtendedPersistentSubscription;

      resolved.isLive = true;

      return resolved;
    } catch (err) {
      this.logger.error(err.message);
    }
  }

  async onEvent(_subscription, payload) {
    const { event } = payload;
    if (/*!payload.isResolved ||*/ !event || !event.isJson) {
      this.logger.error('Received event that could not be resolved!');
      return;
    }

    // TODO use a factory to avoid manual declaration ?
    const eventConstructor = this.eventConstructors[event.eventType];
    if (!eventConstructor) {
      this.logger.error('Received event that could not be handled!');
      return;
    }
    const data = JSON.parse(event.data.toString());
    const metadata = JSON.parse(event.metadata.toString());
    /*
    Two solutions :
    - send an observable on the subject to follow handling
      drawback : it's not what nest is attending
    - build acknowledgeable events, pass them the subscription and let the handler do the hack
      drawback : the subscription pass on the events
     */
    //const builtEvent = this.eventFactory.build(event.eventType, event);
    const builtEvent = eventConstructor(
      data,
      metadata,
      event.eventId,
      event.eventStreamId,
      event.eventNumber,
      new Date(event.createdEpoch),
    );
    if (builtEvent instanceof AcknowledgableEventstoreEvent) {
      builtEvent.setSubscription(_subscription);
    }
    this.subject$.next(builtEvent);
  }

  onDropped(
    subscription: ExtendedPersistentSubscription | ExtendedCatchUpSubscription,
    _reason: string,
    error: Error,
  ) {
    subscription.isLive = false;
    this.logger.error(error);
  }

  onLiveProcessingStarted(subscription: ExtendedCatchUpSubscription) {
    subscription.isLive = true;
    this.logger.log('Live processing of EventStore events started!');
  }

  addEventHandlers(eventHandlers: IEventConstructors) {
    this.eventConstructors = {
      ...this.eventConstructors,
      ...eventHandlers,
    };
  }
}
