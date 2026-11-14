import { Query } from "@nestjs/cqrs";

export interface ProjectInfo {
  name: string;
  framework: string;
  runtime: string;
  greeting: string;
}

export class GetProjectInfoQuery extends Query<ProjectInfo> {}
