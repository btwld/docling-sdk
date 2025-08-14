import { Request } from 'express';
import { AuthInfo } from '../../types/auth.types';

/**
 * Interface for session data in StreamableHTTP controller
 */
export interface StreamableHttpSessionData {
  /**
   * Additional session metadata
   */
  [key: string]: unknown;
}

/**
 * Interface for custom request with auth information
 */
export interface CustomRequest {
  /**
   * Original Express request
   */
  originalRequest: Request;

  /**
   * Authentication information
   */
  auth?: AuthInfo;

  /**
   * Additional request metadata
   */
  [key: string]: unknown;
}
