import { Module } from '@nestjs/common';
import { LedgerModule } from '@sample/ledger';
import { WalletModule } from '@sample/wallet';
import { ClockModule } from './clock.module.js';

@Module({ imports: [ClockModule, WalletModule, LedgerModule] })
export class AppModule {}
