export const nothingToChange = { error: 'Send at least one field to change' };
export const hasAnyField = (changes: object): boolean => Object.keys(changes).length > 0;
