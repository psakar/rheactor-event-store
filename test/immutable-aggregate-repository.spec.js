/* global describe, it, before */

import {ImmutableAggregateRepository, ImmutableAggregateRoot, AggregateMeta, AggregateMetaType} from '../src'
import {Promise} from 'bluebird'
import helper from './helper'
import {expect} from 'chai'
import {ModelEvent} from '../src/model-event'
import {EntryNotFoundError, EntryDeletedError, UnhandledDomainEventError} from '@resourcefulhumans/rheactor-errors'

class DummyModel extends ImmutableAggregateRoot {
  constructor (email, meta) {
    AggregateMetaType(meta, ['DummyModel', 'meta:AggregateMeta'])
    super(meta)
    this.email = email
  }

  /**
   * @param {ModelEvent} event
   * @param {ImmutableAggregateRoot|undefined} aggregate
   * @return {ImmutableAggregateRoot}
   */
  static applyEvent (event, aggregate) {
    switch (event.name) {
      case 'DummyCreatedEvent':
        return new DummyModel(event.data.email, new AggregateMeta(event.aggregateId, 1, event.createdAt))
      case 'DummyDeletedEvent':
        return new DummyModel(aggregate.email, aggregate.meta.deleted(event.createdAt))
      default:
        throw new UnhandledDomainEventError(event.name)
    }
  }
}

describe('ImmutableAggregateRepository', function () {
  before(helper.clearDb)

  let repository

  before(() => {
    repository = new ImmutableAggregateRepository(
      DummyModel,
      'dummy',
      helper.redis
    )
  })

  describe('.add()', () => {
    it('should add entities', () => {
      return Promise.join(repository.add({email: 'john.doe@example.invalid'}, 'someAuthor'), repository.add({email: 'jane.doe@example.invalid'}))
        .spread((event1, event2) => {
          expect(event1).to.be.instanceOf(ModelEvent)
          expect(event1.name).to.equal('DummyCreatedEvent')
          expect(event1.createdBy).to.equal('someAuthor')
          expect(event2).to.be.instanceOf(ModelEvent)
          expect(event2.createdBy).to.equal(undefined)
          return Promise
            .join(repository.getById(event1.aggregateId), repository.getById(event2.aggregateId))
            .spread((u1, u2) => {
              expect(u1.email).to.equal('john.doe@example.invalid')
              expect(u1.meta.version).to.equal(1)
              expect(u2.email).to.equal('jane.doe@example.invalid')
              expect(u2.meta.version).to.equal(1)
            })
        })
    })
  })

  describe('.remove()', () => {
    it('should remove entities', () => {
      return repository.add({email: 'mike.doe@example.invalid'})
        .then((createdEvent) => {
          return repository.getById(createdEvent.aggregateId)
        })
        .then((persistedMike) => {
          expect(persistedMike.meta.isDeleted).to.equal(false)
          return repository
            .remove(persistedMike, 'someAuthor')
            .then((deletedEvent) => {
              expect(deletedEvent).to.be.instanceOf(ModelEvent)
              expect(deletedEvent.name).to.equal('DummyDeletedEvent')
              expect(deletedEvent.createdBy).to.equal('someAuthor')
              return repository.getById(deletedEvent.aggregateId)
                .catch(err => EntryDeletedError.is(err), err => {
                  expect(err.entry.meta.isDeleted).to.equal(true)
                })
            })
        })
    })
  })

  describe('.findById()', () => {
    it(
      'should return undefined if entity not found',
      () => repository.findById('9999999')
        .then((user) => {
          expect(user).to.equal(undefined)
        })
    )
    it('should return undefined if entity is deleted', () => {
      repository.add({email: 'jim.doe@example.invalid'})
        .then((createdEvent) => {
          return repository.getById(createdEvent.aggregateId)
        })
        .then((persistedJim) => {
          return repository
            .remove(persistedJim)
            .then(() => {
              repository.findById(persistedJim.meta.id)
                .then((user) => {
                  expect(user).to.equal(undefined)
                })
            })
        })
    })
  })

  describe('.getById()', () => {
    it(
      'should throw an EntryNotFoundError if entity not found',
      () => Promise.try(repository.getById.bind(repository, '9999999'))
        .catch(err => EntryNotFoundError.is(err), (err) => {
          expect(err.message).to.be.contain('dummy with id "9999999" not found.')
        })
    )
    it('should throw an EntryDeletedError if entity is deleted', () => {
      return repository.add({email: 'jack.doe@example.invalid'})
        .then((createdEvent) => {
          return repository.getById(createdEvent.aggregateId)
        })
        .then((persistedJack) => {
          return repository
            .remove(persistedJack)
            .then(() => {
              Promise
                .try(repository.getById.bind(repository, persistedJack.meta.id))
                .catch(err => EntryDeletedError.is(err), (err) => {
                  expect(err.message).to.be.contain('dummy with id "' + persistedJack.meta.id + '" is deleted.')
                  expect(err.entry.meta.id).to.equal(persistedJack.meta.id)
                  expect(err.entry.email).to.equal(persistedJack.email)
                })
            })
        })
    })
  })

  describe('.findAll()', () => {
    it(
      'should return all entities',
      () => repository.findAll()
        .then((entities) => {
          expect(entities.length).to.equal(2)
          expect(entities[0].email).to.equal('john.doe@example.invalid')
          expect(entities[1].email).to.equal('jane.doe@example.invalid')
        })
    )
  })

  describe('.is()', () => {
    it('should return true, if ImmutableAggregateRepository is passed', () => {
      expect(ImmutableAggregateRepository.is(new ImmutableAggregateRepository({
        applyEvent: () => {
        }
      }, 'foo', {}))).to.equal(true)
    })
    it('should return true, if a similar object is passed', () => {
      const repo = {
        constructor: {name: ImmutableAggregateRepository.name},
        root: '',
        alias: '',
        prefix: '',
        eventStore: {},
        redis: {}
      }
      expect(ImmutableAggregateRepository.is(repo)).to.equal(true)
    })
  })
})
