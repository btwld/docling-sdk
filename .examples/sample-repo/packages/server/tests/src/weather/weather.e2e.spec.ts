import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { WeatherModule } from './weather.module';
import { createMCPClient } from '../../utils';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('Weather MCP (e2e)', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let testPort: number;
  let client: Client;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [WeatherModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableCors();
    await app.init();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;

    client = await createMCPClient(testPort);
  });

  afterAll(async () => {
    if (client) {
      await client.close();
    }

    await app.close();
  });

  it('should connect to the MCP server', () => {
    expect(client).toBeDefined();
  });

  it('should get weather information', async () => {
    const tools = await client.listTools();
    expect(tools).toBeDefined();
    expect(tools.tools.length).toBeGreaterThan(0);

    const weatherTool = tools.tools.find((tool) => tool.name === 'get-weather');
    expect(weatherTool).toBeDefined();

    const result = await client.callTool({
      name: 'get-weather',
      arguments: {
        location: 'New York',
        units: 'metric',
      },
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');

    const weatherData = JSON.parse(result.content[0].text);

    expect(weatherData.location).toBe('New York');
    expect(weatherData.temperature).toBeDefined();
    expect(weatherData.condition).toBeDefined();
  });

  it('should get weather alerts', async () => {
    const tools = await client.listTools();
    const alertTool = tools.tools.find(
      (tool) => tool.name === 'get-weather-alert',
    );
    expect(alertTool).toBeDefined();

    const result = await client.callTool({
      name: 'get-weather-alert',
      arguments: {
        location: 'New York',
      },
    });

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');

    const alertData = JSON.parse(result.content[0].text);

    expect(alertData.location).toBe('New York');
    expect(alertData.alerts).toBeDefined();
    expect(Array.isArray(alertData.alerts)).toBe(true);
  });

  it('should get weather forecast using Zod schema', async () => {
    const tools = await client.listTools();
    const forecastTool = tools.tools.find(
      (tool) => tool.name === 'get-forecast',
    );
    expect(forecastTool).toBeDefined();

    expect(forecastTool.inputSchema).toBeDefined();
    if (
      forecastTool.inputSchema &&
      typeof forecastTool.inputSchema === 'object' &&
      forecastTool.inputSchema.properties &&
      typeof forecastTool.inputSchema.properties === 'object'
    ) {
      const { days, includeHourly } = forecastTool.inputSchema.properties as {
        days: { default?: number };
        includeHourly: { default?: boolean };
      };
      expect(days.default).toBe(3);
      expect(includeHourly.default).toBe(false);
    }

    const result1 = await client.callTool({
      name: 'get-forecast',
      arguments: {
        location: 'Miami',
      },
    });

    expect(result1).toBeDefined();
    expect(result1.content).toBeDefined();
    const forecastData1 = JSON.parse(result1.content[0].text);
    expect(forecastData1.location).toBe('Miami');
    expect(forecastData1.days.length).toBe(3);
    expect(forecastData1.days[0].hourly).toBeUndefined();

    const result2 = await client.callTool({
      name: 'get-forecast',
      arguments: {
        location: 'Seattle',
        days: 5,
        includeHourly: true,
      },
    });

    expect(result2).toBeDefined();
    const forecastData2 = JSON.parse(result2.content[0].text);
    expect(forecastData2.location).toBe('Seattle');
    expect(forecastData2.days.length).toBe(5);
    expect(forecastData2.days[0].hourly).toBeDefined();
    expect(forecastData2.days[0].hourly.length).toBe(24);
  });

  it('should properly validate required fields in DTOs', async () => {
    try {
      await client.callTool({
        name: 'get-weather',
        arguments: {
          units: 'metric',
        },
      });

      expect('Should have thrown an error').toBe(false);
    } catch (error) {
      expect(error.message).toContain('Invalid get-weather parameters');
      expect(error.message).toContain('location');
    }

    try {
      await client.callTool({
        name: 'get-forecast',
        arguments: {
          days: 5,
          includeHourly: true,
        },
      });

      expect('Should have thrown an error').toBe(false);
    } catch (error) {
      expect(error.message).toContain('Invalid get-forecast parameters');
      expect(error.message).toContain('location');
    }
  });
});
