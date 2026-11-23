import { Authenticate, CurrentUser } from "@nestjs/authentication";
import { Controller, UseFilters } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { GrpcMethod, Payload } from "@nestjs/microservices";
import { z } from "zod";
import type { IntegrationPrincipal } from "@/integrations/models/integration.js";
import { IntegrationSecretAuth } from "@/integrations/providers/integration-secret-auth.js";
import { CreateCustomerApiKeyCommand } from "./commands/impl/create-customer-api-key.command.js";
import { RevokeCustomerApiKeyCommand } from "./commands/impl/revoke-customer-api-key.command.js";
import { RotateCustomerApiKeyCommand } from "./commands/impl/rotate-customer-api-key.command.js";
import { UpdateCustomerApiKeyCommand } from "./commands/impl/update-customer-api-key.command.js";
import { ControlPlaneGrpcExceptionFilter } from "./filters/control-plane-grpc-exception.filter.js";
import { ControlPlaneError } from "./models/control-plane-error.js";
import { CONTROL_PLANE_SERVICE } from "./models/control-plane-grpc.js";
import {
  type ApiKeyMessage,
  apiKeyMessageOf,
  type CreateKeyRequest,
  type IssuedKeyMessage,
  issuedKeyMessageOf,
  type KeyIdRequest,
  keyChangesJsonOf,
  type ListKeysRequest,
  type ListKeysResponseMessage,
  listKeysResponseMessageOf,
  type ListModelsResponseMessage,
  listModelsResponseMessageOf,
  type ListUsageLogsRequest,
  type ListUsageLogsResponseMessage,
  listUsageLogsResponseMessageOf,
  newKeyJsonOf,
  type UpdateKeyRequest,
} from "./models/proto-grpc.js";
import { GetCustomerApiKeyQuery } from "./queries/impl/get-customer-api-key.query.js";
import { ListCustomerApiKeysQuery } from "./queries/impl/list-customer-api-keys.query.js";
import { ListIntegrationModelsQuery } from "./queries/impl/list-integration-models.query.js";
import { ListIntegrationUsageLogsQuery } from "./queries/impl/list-integration-usage-logs.query.js";
import {
  customerApiKeyChangesSchema,
  customerApiKeyPageQuerySchema,
  newCustomerApiKeySchema,
} from "./schemas/customer-api-key.schema.js";
import { usageLogPageQuerySchema } from "./schemas/usage-log.schema.js";

/** A request checked with the schema the HTTP adapter checks its body with. */
function parsedRequest<Schema extends z.ZodType>(
  schema: Schema,
  request: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(request);
  if (!parsed.success) {
    throw new ControlPlaneError("INVALID_ARGUMENT", z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/**
 * The control plane's gRPC adapter (control_plane.proto), served by the
 * worker when CONTROL_PLANE_PORT is set. It calls the commands and queries
 * the HTTP adapter calls, with the same Integration Secret rules: the secret
 * comes from the `authorization` metadata. An unset id is NOT_FOUND, as an
 * unknown one is.
 */
@Controller()
@Authenticate({ providers: [IntegrationSecretAuth] })
@UseFilters(ControlPlaneGrpcExceptionFilter)
export class ControlPlaneGrpcController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @GrpcMethod(CONTROL_PLANE_SERVICE, "CreateKey")
  async createKey(
    @Payload() request: CreateKeyRequest,
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<IssuedKeyMessage> {
    const newKey = parsedRequest(newCustomerApiKeySchema, newKeyJsonOf(request));
    const issued = await this.commandBus.execute(
      new CreateCustomerApiKeyCommand(integration, newKey),
    );
    return issuedKeyMessageOf(issued);
  }

  @GrpcMethod(CONTROL_PLANE_SERVICE, "UpdateKey")
  async updateKey(
    @Payload() request: UpdateKeyRequest,
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<ApiKeyMessage> {
    const changes = parsedRequest(customerApiKeyChangesSchema, keyChangesJsonOf(request));
    const apiKey = await this.commandBus.execute(
      new UpdateCustomerApiKeyCommand(integration, request.id ?? "", changes),
    );
    return apiKeyMessageOf(apiKey);
  }

  @GrpcMethod(CONTROL_PLANE_SERVICE, "RotateKey")
  async rotateKey(
    @Payload() request: KeyIdRequest,
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<IssuedKeyMessage> {
    const issued = await this.commandBus.execute(
      new RotateCustomerApiKeyCommand(integration, request.id ?? ""),
    );
    return issuedKeyMessageOf(issued);
  }

  @GrpcMethod(CONTROL_PLANE_SERVICE, "RevokeKey")
  async revokeKey(
    @Payload() request: KeyIdRequest,
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<ApiKeyMessage> {
    const apiKey = await this.commandBus.execute(
      new RevokeCustomerApiKeyCommand(integration, request.id ?? ""),
    );
    return apiKeyMessageOf(apiKey);
  }

  @GrpcMethod(CONTROL_PLANE_SERVICE, "GetKey")
  async getKey(
    @Payload() request: KeyIdRequest,
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<ApiKeyMessage> {
    const apiKey = await this.queryBus.execute(
      new GetCustomerApiKeyQuery(integration, request.id ?? ""),
    );
    return apiKeyMessageOf(apiKey);
  }

  @GrpcMethod(CONTROL_PLANE_SERVICE, "ListKeys")
  async listKeys(
    @Payload() request: ListKeysRequest,
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<ListKeysResponseMessage> {
    const page = parsedRequest(customerApiKeyPageQuerySchema, request);
    const keys = await this.queryBus.execute(new ListCustomerApiKeysQuery(integration, page));
    return listKeysResponseMessageOf(keys);
  }

  @GrpcMethod(CONTROL_PLANE_SERVICE, "ListModels")
  async listModels(
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<ListModelsResponseMessage> {
    const models = await this.queryBus.execute(new ListIntegrationModelsQuery(integration));
    return listModelsResponseMessageOf(models);
  }

  @GrpcMethod(CONTROL_PLANE_SERVICE, "ListUsageLogs")
  async listUsageLogs(
    @Payload() request: ListUsageLogsRequest,
    @CurrentUser() integration: IntegrationPrincipal,
  ): Promise<ListUsageLogsResponseMessage> {
    const page = parsedRequest(usageLogPageQuerySchema, request);
    const usageLogs = await this.queryBus.execute(
      new ListIntegrationUsageLogsQuery(integration, page),
    );
    return listUsageLogsResponseMessageOf(usageLogs);
  }
}
