import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * DTO for WebSocket message
 */
export class WebSocketMessageDto {
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
 * DTO for WebSocket connection options
 */
export class WebSocketConnectionOptionsDto {
  /**
   * Whether this is a test connection
   */
  @IsOptional()
  isTestConnection?: boolean;

  /**
   * Additional connection options
   */
  [key: string]: unknown;
}
