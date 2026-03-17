import { Body, Controller, Param, Post } from '@nestjs/common';
import { SimulatorService } from './simulator.service';

@Controller('devices/:id/sim')
export class SimulatorController {
  constructor(private sim: SimulatorService) {}

  @Post('start')
  start(@Param('id') id: string, @Body() body: any) {
    return this.sim.start(id, body);
  }

  @Post('stop')
  stop(@Param('id') id: string) {
    return this.sim.stop(id);
  }

  @Post('once')
  once(@Param('id') id: string, @Body() body: any) {
    return this.sim.once(id, body);
  }
}
