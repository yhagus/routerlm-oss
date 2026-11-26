import { Module } from '@nestjs/common';
import { CommandHandlers } from './commands/handlers';

@Module({ providers: [...CommandHandlers] })
export class CatalogModule {}
