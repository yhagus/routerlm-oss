import { Test, TestingModule } from "@nestjs/testing";
import { QueryBus } from "@nestjs/cqrs";
import { AppController } from "./app.controller.js";

describe("AppController", () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: QueryBus,
          useValue: { execute: async () => ({ greeting: "Hello World!" }) },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe("root", () => {
    it('should return "Hello World!"', async () => {
      await expect(appController.getHello()).resolves.toBe("Hello World!");
    });
  });
});
