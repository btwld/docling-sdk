/**
 * User interface
 */
export interface User {
  /**
   * User ID
   */
  id: string;
  
  /**
   * Username
   */
  username: string;
  
  /**
   * Email
   */
  email: string;
  
  /**
   * Password (hashed in a real application)
   */
  password: string;
  
  /**
   * User roles
   */
  roles: string[];
}
