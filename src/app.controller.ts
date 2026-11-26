import { Public } from '@nestjs/authentication';
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Public()
  @Get()
  getHello(): string {
    return 'Hello World!';
  }
}
