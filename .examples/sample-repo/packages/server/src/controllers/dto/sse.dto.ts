import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * DTO for SSE message request
 */
export class SseMessageRequestDto {
  /**
   * JSON-RPC version
   */
  @IsString()
  jsonrpc: string;

  /**
   * Request ID
   */
  @IsString()
  id: string;

  /**
   * Method name
   */
  @IsString()
  method: string;

  /**
   * Request parameters
   */
  @IsObject()
  @IsOptional()
  params?: Record<string, unknown>;
}

/**
 * DTO for SSE event
 */
export class SseEventDto {
  /**
   * Event name
   */
  @IsString()
  event: string;

  /**
   * Event data
   */
  @IsObject()
  data: unknown;
}
