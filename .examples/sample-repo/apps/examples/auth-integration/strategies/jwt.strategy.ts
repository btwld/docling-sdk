import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../services/users.service';

/**
 * JWT token payload interface
 */
interface JwtPayload {
  sub: string;
  username: string;
  email?: string;
  roles?: string[];
  [key: string]: unknown;
}

/**
 * JWT strategy for Passport
 * This strategy validates JWT tokens and extracts user information
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'your-secret-key',
    });
  }

  /**
   * Validate JWT payload and return user
   * @param payload JWT payload
   * @returns User object
   */
  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);
    
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    
    // Return user object that will be attached to request
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      roles: user.roles,
    };
  }
}
