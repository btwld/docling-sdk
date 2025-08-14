import { SetMetadata } from '@nestjs/common';

/**
 * Public route key
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Public decorator
 * This decorator marks a route as public (no authentication required)
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
