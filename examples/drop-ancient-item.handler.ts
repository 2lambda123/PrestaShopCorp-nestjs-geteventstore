import { Injectable } from '@nestjs/common';
import { HeroRepository } from '../repositories';
import { DropAncientItemCommand } from '../commands';
import { HeroAggregate } from '../aggregates';

@Injectable()
export class DropAncientItemHandler {
  constructor(private readonly heroRepository: HeroRepository) {}

  async handle(command: DropAncientItemCommand): Promise<void> {
    const heroId = command.heroId;
    const hero = await this.heroRepository.findById(heroId);
    const heroAggregate = new HeroAggregate(hero);

    heroAggregate.addItem();

    heroAggregate.applyEvent('hero-found-item', {
      ancientItemId: command.ancientItemId,
    });

    heroAggregate.dropItem();

    heroAggregate.applyEvent('hero-drop-item', {
      ancientItemId: command.ancientItemId,
    });

    await heroAggregate.commit();
  }
}
