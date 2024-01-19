import { Injectable } from '@nestjs/common';
import { Event } from 'event-store'; // Assuming the event store library is imported

@Injectable()
export class HeroKilledDragonHandler {
  constructor() {
    // Initialize any required dependencies
  }

  async handle(event: Event): Promise<void> {
    // Log the details of the event received from the event store
    console.log('Received hero-killed-dragon event:', event);
  }
}
