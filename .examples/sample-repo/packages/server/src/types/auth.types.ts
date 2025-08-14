/**
 * Authentication information types
 */

/**
 * Basic authentication information
 */
export interface AuthInfo {
  /**
   * User ID
   */
  userId?: string;

  /**
   * Username
   */
  username?: string;

  /**
   * User email
   */
  email?: string;

  /**
   * User roles
   */
  roles?: string[];

  /**
   * Authentication scope
   */
  scope?: string | string[];

  /**
   * Authentication token
   */
  token?: string;

  /**
   * Additional authentication metadata
   */
  [key: string]: unknown;
}

/**
 * Authentication context
 */
export interface AuthContext {
  /**
   * Authentication information
   */
  authInfo?: AuthInfo;

  /**
   * Additional context metadata
   */
  [key: string]: unknown;
}
