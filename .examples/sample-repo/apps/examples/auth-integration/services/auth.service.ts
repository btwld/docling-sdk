import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { User } from '../interfaces/user.interface';

/**
 * Authentication service
 * This service handles user authentication and token generation
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Validate user credentials
   * @param username Username
   * @param password Password
   * @returns User object if valid
   */
  async validateUser(username: string, password: string): Promise<User> {
    const user = await this.usersService.findByUsername(username);
    
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    
    // In a real application, you would hash the password and compare
    // For this example, we're just checking if the password matches
    if (user.password !== password) {
      throw new UnauthorizedException('Invalid credentials');
    }
    
    return user;
  }

  /**
   * Generate JWT token for user
   * @param user User object
   * @returns Token object
   */
  async login(user: User) {
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
    };
    
    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: user.roles,
      },
    };
  }
}
