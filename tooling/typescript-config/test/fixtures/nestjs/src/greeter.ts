const Injectable = (): ClassDecorator => () => {};

export class Clock {
  now(): Date {
    return new Date();
  }
}

@Injectable()
export class Greeter {
  constructor(private readonly clock: Clock) {}

  greet(): string {
    return `Hello at ${this.clock.now().toISOString()}`;
  }
}
