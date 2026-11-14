import { Controller, Get } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { GetProjectInfoQuery } from "./cqrs/project-info.query.js";

@Controller()
export class AppController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  async getHello(): Promise<string> {
    const projectInfo = await this.queryBus.execute(new GetProjectInfoQuery());
    return projectInfo.greeting;
  }
}
