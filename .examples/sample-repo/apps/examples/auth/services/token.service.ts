import { Injectable } from '@nestjs/common';

/**
 * Service for generating and validating tokens
 * This is a simplified implementation for demonstration purposes
 */
@Injectable()
export class TokenService {
  // Demo users - in a real app, these would be in a database
  private readonly users = [
    {
      id: 'user1',
      username: 'alice',
      email: 'alice@example.com',
      roles: ['user'],
    },
    {
      id: 'user2',
      username: 'bob',
      email: 'bob@example.com',
      roles: ['user', 'admin'],
    },
  ];

  /**
   * Get a token for a user
   * @param username Username
   * @returns Token or null if user not found
   */
  getTokenForUser(username: string): string | null {
    const user = this.users.find(u => u.username === username);
    if (!user) {
      return null;
    }
    
    // In a real app, we would generate a proper JWT token
    // For this demo, we'll just use the user ID as the token
    return user.id;
  }

  /**
   * Get all available users
   * @returns List of users
   */
  getAllUsers() {
    return this.users.map(user => ({
      username: user.username,
      email: user.email,
      roles: user.roles,
    }));
  }
}
