import { Global, Module } from '@nestjs/common';
import { CLOCK } from '@sample/kernel';
import { systemClock } from './system-clock.js';

@Global()
@Module({ providers: [{ provide: CLOCK, useValue: systemClock }], exports: [CLOCK] })
export class ClockModule {}
