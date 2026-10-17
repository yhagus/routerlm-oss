import chalk from "chalk";
import ora from "ora";

/**
 * UI Helper Functions
 */

export function success(message: any) {
  console.log(chalk.green(`\n✓ ${message}\n`));
}

export function error(message: any) {
  console.log(chalk.red(`\n✗ ${message}\n`));
}

export function info(message: any) {
  console.log(chalk.blue(`\n${message}\n`));
}

export function warn(message: any) {
  console.log(chalk.yellow(`\n⚠ ${message}\n`));
}

export function gray(message: any) {
  console.log(chalk.gray(message));
}

export function spinner(text: any) {
  return ora(text);
}

export function printSection(title: any) {
  console.log(chalk.blue(`\n${title}\n`));
}

export function printKeyValue(key: any, value: any, isSuccess = false) {
  const color = isSuccess ? chalk.green : chalk.gray;
  console.log(color(`  ${key}: ${value}`));
}

export function printList(items: any, isSuccess = false) {
  const symbol = isSuccess ? "✓" : "✗";
  const color = isSuccess ? chalk.green : chalk.gray;
  items.forEach((item: any) => {
    console.log(color(`  ${symbol} ${item}`));
  });
}

