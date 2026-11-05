export const assertNever = (value: never): never => {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
};
