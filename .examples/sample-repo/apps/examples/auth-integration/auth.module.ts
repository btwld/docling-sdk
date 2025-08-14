import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuthController } from './controllers/auth.controller';
import { UsersService } from './services/users.service';

/**
 * Auth module that integrates with NestJS authentication system
 * This module provides JWT authentication for MCP
 */
@Module({
  imports: [
    // Import PassportModule with default strategy
    PassportModule.register({ defaultStrategy: 'jwt' }),
    
    // Import JwtModule with configuration
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, UsersService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
