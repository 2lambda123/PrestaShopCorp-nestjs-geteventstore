import { Injectable } from '@nestjs/common';
import { CommandBus } from 'nestjs-command-bus'; // Assuming the command bus library is imported
import { Event } from 'event-store'; // Assuming the event store library is imported
import { DropAncientItemCommand } from '../commands'; // Import the DropAncientItemCommand from the appropriate file

@Injectable()
export class HeroesSagas {
  constructor(private readonly commandBus: CommandBus) {}

  async handleHeroKilledDragonEvent(event: Event): Promise<void> {
    // Perform any necessary business logic or calculations based on the event data
    const dragonId = event.data.dragonId;
    const heroId = event.data.heroId;

    // Send the "drop-ancient-item" command to the command bus
    const dropAncientItemCommand = new DropAncientItemCommand(dragonId, heroId);
    await this.commandBus.execute(dropAncientItemCommand);
  }
}
