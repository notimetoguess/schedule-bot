export class AuthLoginCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(userId, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(userId) === current) this.tails.delete(userId);
    }
  }
}
