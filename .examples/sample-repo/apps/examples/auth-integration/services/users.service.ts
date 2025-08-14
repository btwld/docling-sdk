import { Injectable } from '@nestjs/common';
import { User } from '../interfaces/user.interface';

/**
 * Users service
 * This service handles user management
 * In a real application, this would connect to a database
 */
@Injectable()
export class UsersService {
  // Mock users database
  private readonly users: User[] = [
    {
      id: '1',
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
      roles: ['user'],
    },
    {
      id: '2',
      username: 'bob',
      email: 'bob@example.com',
      password: 'password123',
      roles: ['user', 'admin'],
    },
  ];

  /**
   * Find user by ID
   * @param id User ID
   * @returns User object or undefined
   */
  async findById(id: string): Promise<User | undefined> {
    return this.users.find(user => user.id === id);
  }

  /**
   * Find user by username
   * @param username Username
   * @returns User object or undefined
   */
  async findByUsername(username: string): Promise<User | undefined> {
    return this.users.find(user => user.username === username);
  }

  /**
   * Get all users
   * @returns Array of users
   */
  async findAll(): Promise<Omit<User, 'password'>[]> {
    return this.users.map(({ password, ...user }) => user);
  }
}
