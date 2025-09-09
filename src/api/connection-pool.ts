/**
 * HTTP connection pooling for better performance
 * Implements connection reuse and management for the Docling HTTP client
 */

import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { URL } from "node:url";

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
  /**
   * Maximum number of sockets to allow per host
   */
  maxSockets: number;

  /**
   * Maximum number of sockets to leave open in a free state
   */
  maxFreeSockets: number;

  /**
   * Timeout for unused sockets in milliseconds
   */
  timeout: number;

  /**
   * Keep-alive timeout in milliseconds
   */
  keepAliveTimeout: number;

  /**
   * Enable keep-alive
   */
  keepAlive: boolean;

  /**
   * Maximum number of requests per socket
   */
  maxRequestsPerSocket?: number;

  /**
   * Socket timeout in milliseconds
   */
  socketTimeout?: number;
}

/**
 * Default connection pool configuration
 */
const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveTimeout: 30000,
  keepAlive: true,
  maxRequestsPerSocket: 100,
  socketTimeout: 30000,
};

/**
 * Connection pool statistics
 */
export interface PoolStats {
  totalSockets: number;
  freeSockets: number;
  activeSockets: number;
  pendingRequests: number;
  totalRequests: number;
  totalConnections: number;
  totalTimeouts: number;
  totalErrors: number;
}

/**
 * Connection pool manager
 */
export class ConnectionPool {
  private httpAgent: HttpAgent;
  private httpsAgent: HttpsAgent;
  private config: ConnectionPoolConfig;
  private stats: PoolStats;
  private requestCount = 0;
  private connectionCount = 0;
  private timeoutCount = 0;
  private errorCount = 0;

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.stats = {
      totalSockets: 0,
      freeSockets: 0,
      activeSockets: 0,
      pendingRequests: 0,
      totalRequests: 0,
      totalConnections: 0,
      totalTimeouts: 0,
      totalErrors: 0,
    };

    this.httpAgent = this.createHttpAgent();
    this.httpsAgent = this.createHttpsAgent();
  }

  /**
   * Create HTTP agent with connection pooling
   */
  private createHttpAgent(): HttpAgent {
    const agent = new HttpAgent({
      keepAlive: this.config.keepAlive,
      keepAliveMsecs: this.config.keepAliveTimeout,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: this.config.maxFreeSockets,
      timeout: this.config.timeout,
      scheduling: "fifo",
    });

    this.setupAgentEventListeners(agent);
    return agent;
  }

  /**
   * Create HTTPS agent with connection pooling
   */
  private createHttpsAgent(): HttpsAgent {
    const agent = new HttpsAgent({
      keepAlive: this.config.keepAlive,
      keepAliveMsecs: this.config.keepAliveTimeout,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: this.config.maxFreeSockets,
      timeout: this.config.timeout,
      scheduling: "fifo",
    });

    this.setupAgentEventListeners(agent);
    return agent;
  }

  /**
   * Setup event listeners for agent monitoring
   */
  private setupAgentEventListeners(agent: HttpAgent | HttpsAgent): void {
    agent.on("connect", () => {
      this.connectionCount++;
      this.updateStats();
    });

    agent.on("free", () => {
      this.updateStats();
    });

    agent.on("timeout", () => {
      this.timeoutCount++;
      this.updateStats();
    });
  }

  /**
   * Get appropriate agent for URL
   */
  getAgent(url: string | URL): HttpAgent | HttpsAgent {
    const urlObj = typeof url === "string" ? new URL(url) : url;
    this.requestCount++;
    this.updateStats();

    return urlObj.protocol === "https:" ? this.httpsAgent : this.httpAgent;
  }

  /**
   * Update connection pool statistics
   */
  private updateStats(): void {
    const httpSockets = this.httpAgent.sockets || {};
    const httpFreeSockets = this.httpAgent.freeSockets || {};
    const httpRequests = this.httpAgent.requests || {};

    const httpsSockets = this.httpsAgent.sockets || {};
    const httpsFreeSockets = this.httpsAgent.freeSockets || {};
    const httpsRequests = this.httpsAgent.requests || {};

    let totalSockets = 0;
    let freeSockets = 0;
    let pendingRequests = 0;

    for (const host in httpSockets) {
      const sockets = httpSockets[host];
      if (sockets) {
        totalSockets += sockets.length;
      }
    }
    for (const host in httpFreeSockets) {
      const sockets = httpFreeSockets[host];
      if (sockets) {
        freeSockets += sockets.length;
      }
    }
    for (const host in httpRequests) {
      const requests = httpRequests[host];
      if (requests) {
        pendingRequests += requests.length;
      }
    }

    for (const host in httpsSockets) {
      const sockets = httpsSockets[host];
      if (sockets) {
        totalSockets += sockets.length;
      }
    }
    for (const host in httpsFreeSockets) {
      const sockets = httpsFreeSockets[host];
      if (sockets) {
        freeSockets += sockets.length;
      }
    }
    for (const host in httpsRequests) {
      const requests = httpsRequests[host];
      if (requests) {
        pendingRequests += requests.length;
      }
    }

    this.stats = {
      totalSockets,
      freeSockets,
      activeSockets: totalSockets - freeSockets,
      pendingRequests,
      totalRequests: this.requestCount,
      totalConnections: this.connectionCount,
      totalTimeouts: this.timeoutCount,
      totalErrors: this.errorCount,
    };
  }

  /**
   * Get current pool statistics
   */
  getStats(): PoolStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get pool health information
   */
  getHealth(): {
    healthy: boolean;
    issues: string[];
    utilization: number;
    efficiency: number;
  } {
    const stats = this.getStats();
    const issues: string[] = [];

    const utilization = stats.activeSockets / this.config.maxSockets;
    if (utilization > 0.8) {
      issues.push("High socket utilization (>80%)");
    }

    if (stats.pendingRequests > stats.totalSockets * 2) {
      issues.push("High number of pending requests");
    }

    if (stats.totalTimeouts > stats.totalRequests * 0.05) {
      issues.push("High timeout rate (>5%)");
    }

    if (stats.totalErrors > stats.totalRequests * 0.02) {
      issues.push("High error rate (>2%)");
    }

    const efficiency =
      stats.totalRequests > 0
        ? (stats.totalRequests - stats.totalTimeouts - stats.totalErrors) / stats.totalRequests
        : 1;

    return {
      healthy: issues.length === 0,
      issues,
      utilization,
      efficiency,
    };
  }

  /**
   * Update pool configuration
   */
  updateConfig(newConfig: Partial<ConnectionPoolConfig>): void {
    this.config = { ...this.config, ...newConfig };

    this.destroy();
    this.httpAgent = this.createHttpAgent();
    this.httpsAgent = this.createHttpsAgent();
  }

  /**
   * Destroy all connections and clean up
   */
  destroy(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }

  /**
   * Force close idle connections
   */
  closeIdleConnections(): void {
    const httpFreeSockets = this.httpAgent.freeSockets || {};
    for (const host in httpFreeSockets) {
      const sockets = httpFreeSockets[host];
      if (sockets) {
        for (const socket of sockets) {
          socket.destroy();
        }
      }
    }

    const httpsFreeSockets = this.httpsAgent.freeSockets || {};
    for (const host in httpsFreeSockets) {
      const sockets = httpsFreeSockets[host];
      if (sockets) {
        for (const socket of sockets) {
          socket.destroy();
        }
      }
    }

    this.updateStats();
  }

  /**
   * Get detailed connection information
   */
  getConnectionDetails(): {
    http: {
      hosts: string[];
      totalSockets: number;
      freeSockets: number;
      pendingRequests: number;
    };
    https: {
      hosts: string[];
      totalSockets: number;
      freeSockets: number;
      pendingRequests: number;
    };
  } {
    const httpSockets = this.httpAgent.sockets || {};
    const httpFreeSockets = this.httpAgent.freeSockets || {};
    const httpRequests = this.httpAgent.requests || {};

    const httpsSockets = this.httpsAgent.sockets || {};
    const httpsFreeSockets = this.httpsAgent.freeSockets || {};
    const httpsRequests = this.httpsAgent.requests || {};

    const httpHosts = [
      ...Object.keys(httpSockets),
      ...Object.keys(httpFreeSockets),
      ...Object.keys(httpRequests),
    ];

    const httpsHosts = [
      ...Object.keys(httpsSockets),
      ...Object.keys(httpsFreeSockets),
      ...Object.keys(httpsRequests),
    ];

    return {
      http: {
        hosts: [...new Set(httpHosts)],
        totalSockets: Object.values(httpSockets).reduce(
          (sum, sockets) => sum + (sockets?.length || 0),
          0
        ),
        freeSockets: Object.values(httpFreeSockets).reduce(
          (sum, sockets) => sum + (sockets?.length || 0),
          0
        ),
        pendingRequests: Object.values(httpRequests).reduce(
          (sum, requests) => sum + (requests?.length || 0),
          0
        ),
      },
      https: {
        hosts: [...new Set(httpsHosts)],
        totalSockets: Object.values(httpsSockets).reduce(
          (sum, sockets) => sum + (sockets?.length || 0),
          0
        ),
        freeSockets: Object.values(httpsFreeSockets).reduce(
          (sum, sockets) => sum + (sockets?.length || 0),
          0
        ),
        pendingRequests: Object.values(httpsRequests).reduce(
          (sum, requests) => sum + (requests?.length || 0),
          0
        ),
      },
    };
  }
}
