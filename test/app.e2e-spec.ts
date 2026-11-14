import { Test, TestingModule } from "@nestjs/testing";
import { NestNodeApplication, NodeAdapter } from "@nestjs/platform-node";
import request from "supertest";
import { AppModule } from "./../src/app.module.js";

describe("AppController (e2e)", () => {
  let app: NestNodeApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestNodeApplication>(new NodeAdapter());
    await app.init();
  });

  it("/ (GET)", () => {
    return request(app.getHttpServer()).get("/").expect(200).expect("Hello World!");
  });

  afterEach(async () => {
    await app.close();
  });
});
