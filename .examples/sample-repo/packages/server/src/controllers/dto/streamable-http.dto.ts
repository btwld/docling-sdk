import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * DTO for StreamableHTTP initialization request
 */
export class StreamableHttpInitRequestDto {
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
 * DTO for StreamableHTTP session options
 */
export class StreamableHttpSessionOptionsDto {
  /**
   * Additional session options
   */
  [key: string]: unknown;
}
