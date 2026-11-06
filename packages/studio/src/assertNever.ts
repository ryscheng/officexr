export const assertNever = (value: never): never => {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
};
