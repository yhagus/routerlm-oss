import { Injectable } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Tool } from "@nestjs/mcp";
import * as z from "zod";
import { EchoCommand } from "../cqrs/echo.command.js";
import { GetProjectInfoQuery } from "../cqrs/project-info.query.js";

@Injectable()
export class McpToolsService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Tool({
    name: "project_info",
    description: "Return basic information about the RouterLM NestJS server.",
    inputSchema: z.object({}),
  })
  projectInfo() {
    return this.queryBus.execute(new GetProjectInfoQuery());
  }

  @Tool({
    name: "echo",
    description: "Return the supplied text.",
    inputSchema: z.object({ text: z.string().min(1).describe("Text to return") }),
  })
  echo({ text }: { text: string }) {
    return this.commandBus.execute(new EchoCommand(text));
  }
}
