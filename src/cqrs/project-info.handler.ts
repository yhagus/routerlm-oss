import { IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { GetProjectInfoQuery, ProjectInfo } from "./project-info.query.js";

@QueryHandler(GetProjectInfoQuery)
export class GetProjectInfoHandler implements IQueryHandler<GetProjectInfoQuery> {
  async execute(): Promise<ProjectInfo> {
    return {
      name: "routerlm-nest",
      framework: "NestJS",
      runtime: "Bun",
      greeting: "Hello World!",
    };
  }
}
