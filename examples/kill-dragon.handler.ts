import { Injectable } from '@nestjs/common';
import { HeroRepository } from '../repositories';
import { killDragonCommand } from '../commands';
import { HeroAggregate } from '../aggregates';

@Injectable()
export class KillDragonHandler {
  constructor(private readonly heroRepository: HeroRepository) {}

  async handle(command: killDragonCommand): Promise<void> {
    const heroId = command.heroId;
    const hero = await this.heroRepository.findById(heroId);
    const heroAggregate = new HeroAggregate(hero);

    heroAggregate.killEnemy();

    heroAggregate.applyEvent('hero-killed-dragon', {
      dragonId: command.dragonId,
    });

    await heroAggregate.commit();
  }
}
