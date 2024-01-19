import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { killDragonCommand } from '../commands';
import { KillDragonHandler } from '../handlers';

@Controller('kill-dragon')
export class KillDragonController {
  constructor(private readonly killDragonHandler: KillDragonHandler) {}

  @Post()
  @HttpCode(204)
  async killDragon(@Body() commandData: killDragonCommand) {
    const command = new killDragonCommand(commandData);
    await this.killDragonHandler.handle(command);
  }
}
