import { Injectable } from '@nestjs/common';
import { Tool } from '../../lib/decorators';
import { z } from 'zod';
import { createStructuredResponse } from '../../lib/utils/response.util';

/**
 * Example weather tool provider with structured output
 */
@Injectable()
export class WeatherToolProvider {
  /**
   * Get weather information for a city
   * @param city City name
   * @param country Country code
   * @returns Weather information with structured output
   */
  @Tool({
    name: 'get_weather',
    description: 'Get weather information for a city',
    parameters: z.object({
      city: z.string().describe('City name'),
      country: z.string().describe('Country code (e.g., US, UK)'),
    }),
    outputSchema: z.object({
      temperature: z.object({
        celsius: z.number(),
        fahrenheit: z.number(),
      }),
      conditions: z.enum(['sunny', 'cloudy', 'rainy', 'stormy', 'snowy']),
      humidity: z.number().min(0).max(100),
      wind: z.object({
        speed_kmh: z.number(),
        direction: z.string(),
      }),
    }),
  })
  async getWeather(params: { city: string; country: string }) {
    // Simulate weather API call
    const temp_c = Math.round((Math.random() * 35 - 5) * 10) / 10;
    const conditions = ['sunny', 'cloudy', 'rainy', 'stormy', 'snowy'][
      Math.floor(Math.random() * 5)
    ];

    // Create structured content response
    const structuredContent = {
      temperature: {
        celsius: temp_c,
        fahrenheit: Math.round((temp_c * 9/5 + 32) * 10) / 10,
      },
      conditions,
      humidity: Math.round(Math.random() * 100),
      wind: {
        speed_kmh: Math.round(Math.random() * 50),
        direction: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
          Math.floor(Math.random() * 8)
        ],
      },
    };

    return createStructuredResponse(structuredContent);
  }

  /**
   * Get forecast information for a city
   * @param city City name
   * @param country Country code
   * @param days Number of days
   * @returns Forecast information with structured output
   */
  @Tool({
    name: 'get_forecast',
    description: 'Get forecast information for a city',
    parameters: z.object({
      city: z.string().describe('City name'),
      country: z.string().describe('Country code (e.g., US, UK)'),
      days: z.number().min(1).max(7).default(3).describe('Number of days'),
    }),
    outputSchema: z.object({
      location: z.object({
        city: z.string(),
        country: z.string(),
      }),
      forecast: z.array(
        z.object({
          date: z.string(),
          temperature: z.object({
            min: z.number(),
            max: z.number(),
          }),
          conditions: z.enum(['sunny', 'cloudy', 'rainy', 'stormy', 'snowy']),
          precipitation: z.number().min(0).max(100),
        })
      ),
    }),
  })
  async getForecast(params: { city: string; country: string; days: number }) {
    const { city, country, days } = params;
    
    // Generate forecast data
    const forecast = Array.from({ length: days }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() + i);
      
      return {
        date: date.toISOString().split('T')[0],
        temperature: {
          min: Math.round((Math.random() * 15) * 10) / 10,
          max: Math.round((Math.random() * 15 + 15) * 10) / 10,
        },
        conditions: ['sunny', 'cloudy', 'rainy', 'stormy', 'snowy'][
          Math.floor(Math.random() * 5)
        ],
        precipitation: Math.round(Math.random() * 100),
      };
    });

    // Create structured content response
    const structuredContent = {
      location: {
        city,
        country,
      },
      forecast,
    };

    return createStructuredResponse(structuredContent);
  }
}
