# Pooler

[![npm](https://img.shields.io/npm/v/pooler.svg?style=for-the-badge)](https://img.shields.io/npm/v/pooler)
[![npm downloads](https://img.shields.io/npm/dt/pooler.svg?style=for-the-badge)](https://www.npmjs.com/package/pooler)
[![GitHub issues](https://img.shields.io/github/issues/alexsasharegan/pooler.svg?style=for-the-badge)](https://github.com/alexsasharegan/pooler/issues)
[![Travis](https://img.shields.io/travis/alexsasharegan/pooler.svg?style=for-the-badge)](https://github.com/alexsasharegan/pooler)
[![Coverage Status](https://img.shields.io/coveralls/github/alexsasharegan/pooler.svg?style=for-the-badge)](https://coveralls.io/github/alexsasharegan/pooler)
[![GitHub license](https://img.shields.io/github/license/alexsasharegan/pooler.svg?style=for-the-badge)](https://github.com/alexsasharegan/pooler/blob/master/LICENSE.md)

A generic pooling interface and TypeScript/JavaScript implementation.

## The interface

The heart of `pooler` is the interface. The interface is largely taken from the
Go standard library where the two key methods are `get` and `put`.

Unique to this library is the method `use`. The `use` method is a convenience
feature that abstracts the logic of both `get` and `put` by passing in a
callback to be executed with a value from the pool. This is especially nice for
making single queries to a database. It removes the need for a lot of
boilerplate code, and also removes the possibility you forget to put the value
back in the pool.

![pooler interface](./docs/pooler-interface.1.png)

## Basic Usage

To get started, created a pooler from the implementation's option object.

![basic usage with database](./docs/db-basic.1.png)
