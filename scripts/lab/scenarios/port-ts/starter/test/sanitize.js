import { format } from 'node:util';
import validator from './lib.js';

export function sanitize(options) {
  let args = options.args || [];

  args.unshift(null);

  Object.keys(options.expect).forEach((input) => {
    args[0] = input;
    let result = validator[options.sanitizer](...args);
    let expected = options.expect[input];
    if (isNaN(result) && !result.length && isNaN(expected)) {
      return;
    }

    if (result !== expected) {
      let warning = format(
        'validator.%s(%s) returned "%s" but should have returned "%s"',
        options.sanitizer, args.join(', '), result, expected
      );

      throw new Error(warning);
    }
  });
}
