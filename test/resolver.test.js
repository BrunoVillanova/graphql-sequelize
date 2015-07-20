'use strict';

var chai = require('chai')
  , expect = chai.expect
  , resolver = require('../src/resolver')
  , helper = require('./helper')
  , Sequelize = require('sequelize')
  , sinon = require('sinon')
  , sequelize = helper.sequelize
  , Promise = helper.Promise;

import {
  graphql,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLList
} from 'graphql';

describe('resolver', function () {
  var User
    , Task
    , taskType
    , userType
    , schema;

  User = sequelize.define('user', {
    name: Sequelize.STRING
  }, {
    timestamps: false
  });

  Task = sequelize.define('task', {
    title: Sequelize.STRING,
    createdAt: {
      type: Sequelize.DATE,
      field: 'created_at',
      defaultValue: Sequelize.NOW
    }
  }, {
    timestamps: false
  });

  User.Tasks = User.hasMany(Task, {as: 'tasks', foreignKey: 'userId'});
  Task.User = Task.belongsTo(User, {as: 'user', foreignKey: 'userId'});

  taskType = new GraphQLObjectType({
    name: 'Task',
    description: 'A task',
    fields: {
      id: {
        type: new GraphQLNonNull(GraphQLInt)
      },
      title: {
        type: GraphQLString
      }
    }
  });

  userType = new GraphQLObjectType({
    name: 'User',
    description: 'A user',
    fields: {
      id: {
        type: new GraphQLNonNull(GraphQLInt),
      },
      name: {
        type: GraphQLString,
      },
      tasks: {
        type: new GraphQLList(taskType),
        args: {
          limit: {
            type: GraphQLInt
          },
          order: {
            type: GraphQLString
          },
          first: {
            type: GraphQLInt
          }
        },
        resolve: resolver(User.Tasks, {
          before: function(options, args) {
            if (args.first) {
              options.order = options.order || [];
              options.order.push(['created_at', 'ASC']);

              if (args.first !== 0) {
                options.limit = args.first;
              }
            }

            return options;
          }
        })
      }
    }
  });

  schema = new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'RootQueryType',
      fields: {
        user: {
          type: userType,
          args: {
            id: {
              type: new GraphQLNonNull(GraphQLInt)
            }
          },
          resolve: resolver(User)
        },
        users: {
          type: new GraphQLList(userType),
          args: {
            limit: {
              type: GraphQLInt
            },
            order: {
              type: GraphQLString
            }
          },
          resolve: resolver(User)
        }
      }
    })
  });

  before(function () {
    var userId = 0
      , taskId = 0;

    return this.sequelize.sync({force: true}).bind(this).then(function () {
      return Promise.join(
        User.create({
          id: 1,
          name: 'b'+Math.random().toString(),
          tasks: [
            {
              id: ++taskId,
              title: Math.random().toString(),
              createdAt: new Date(Date.UTC(2014, 5, 11))
            },
            {
              id: ++taskId,
              title: Math.random().toString(),
              createdAt: new Date(Date.UTC(2014, 5, 16))
            },
            {
              id: ++taskId,
              title: Math.random().toString(),
              createdAt: new Date(Date.UTC(2014, 5, 20))
            }
          ]
        }, {
          include: [User.Tasks]
        }),
        User.create({
          id: 2,
          name: 'a'+Math.random().toString(),
          tasks: [
            {
              id: ++taskId,
              title: Math.random().toString()
            },
            {
              id: ++taskId,
              title: Math.random().toString()
            }
          ]
        }, {
          include: [User.Tasks]
        })
      ).bind(this).spread(function (userA, userB) {
        this.userA = userA;
        this.userB = userB;
        this.users = [userA, userB];
      });
    });
  });

  it('should resolve a plain result with a single model', function () {
    var user = this.userB;

    return graphql(schema, `
      {
        user(id: ${user.id}) {
          name
        }
      }
    `).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data).to.deep.equal({
        user: {
          name: user.name
        }
      });
    });
  });

  it('should resolve an array result with a single model', function () {
    var users = this.users;

    return graphql(schema, `
      {
        users {
          name
        }
      }
    `).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.users).to.have.length.above(0);
      expect(result.data).to.deep.equal({
        users: users.map(user => ({name: user.name}))
      });
    });
  });

  it('should allow ammending the find for a array result with a single model', function () {
    var user = this.userA
      , schema;

    schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'RootQueryType',
        fields: {
          users: {
            type: new GraphQLList(userType),
            args: {
              limit: {
                type: GraphQLInt
              },
              order: {
                type: GraphQLString
              }
            },
            resolve: resolver(User, {
              before: function(options, args, root) {
                options.where = options.where || {};
                options.where.name = root.name;
                return options;
              }
            })
          }
        }
      })
    });

    return graphql(schema, `
      {
        users {
          name
        }
      }
    `, {
      name: user.name
    }).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.users).to.have.length(1);
      expect(result.data.users[0].name).to.equal(user.name);
    });
  });

  it('should work with a resolver through a proxy', function () {
    var users = this.users
      , schema
      , userType
      , taskType
      , spy = sinon.spy();

    taskType = new GraphQLObjectType({
      name: 'Task',
      description: 'A task',
      fields: {
        id: {
          type: new GraphQLNonNull(GraphQLInt)
        },
        title: {
          type: GraphQLString
        }
      }
    });

    userType = new GraphQLObjectType({
      name: 'User',
      description: 'A user',
      fields: {
        id: {
          type: new GraphQLNonNull(GraphQLInt),
        },
        name: {
          type: GraphQLString,
        },
        tasks: {
          type: new GraphQLList(taskType),
          resolve: (function () {
            var $resolver = resolver(User.Tasks)
              , $proxy;

            $proxy = function() {
              return $resolver.apply(null, Array.prototype.slice.call(arguments))
            };

            $proxy.$proxy = $resolver;
            return $proxy;
          })()
        }
      }
    });

    schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'RootQueryType',
        fields: {
          users: {
            type: new GraphQLList(userType),
            args: {
              limit: {
                type: GraphQLInt
              },
              order: {
                type: GraphQLString
              }
            },
            resolve: resolver(User)
          }
        }
      })
    });

    return graphql(schema, `
      {
        users {
          name,
          tasks {
            title
          }
        }
      }
    `, {
      logging: spy
    }).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.users).to.have.length(users.length);
      result.data.users.forEach(function (user) {
        expect(user.tasks).to.have.length.above(0);
      });

      expect(spy).to.have.been.calledOnce;
    });
  });

  it('should resolve an array result with a single model and limit', function () {
    var users = this.users;

    return graphql(schema, `
      {
        users(limit: 1) {
          name
        }
      }
    `).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.users).to.have.length(1);
    });
  });

  it('should resolve a plain result with a single hasMany association', function () {
    var user = this.userB;

    return graphql(schema, `
      { 
        user(id: ${user.id}) {
          name
          tasks {
            title
          }
        }
      }
    `, {
      yolo: 'swag'
    }).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.user.tasks).to.have.length.above(0);
      expect(result.data).to.deep.equal({
        user: {
          name: user.name,
          tasks: user.tasks.map(task => ({title: task.title}))
        }
      });
    });
  });

  it('should resolve a plain result with a single limited hasMany association', function () {
    var user = this.userB;

    return graphql(schema, `
      { 
        user(id: ${user.id}) {
          name
          tasks(limit: 1) {
            title
          }
        }
      }
    `).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.user.tasks).to.have.length(1);
    });
  });

  it('should resolve a array result with a single hasMany association', function () {
    var users = this.users;

    return graphql(schema, `
      {
        users(order: "id") { 
          name
          tasks(order: "id") {
            title
          }
        }
      }
    `).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.users.length).to.equal(users.length);
      result.data.users.forEach(function (user) {
        expect(user.tasks).length.to.be.above(0);
      });

      expect(result.data).to.deep.equal({
        users: users.map(function (user) {
          return {
            name: user.name,
            tasks: user.tasks.map(task => ({title: task.title}))
          }
        })
      });
    });
  });

  it('should resolve a array result with a single limited hasMany association', function () {
    var users = this.users;

    return graphql(schema, `
      {
        users { 
          name
          tasks(limit: 1) {
            title
          }
        }
      }
    `).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.users.length).to.equal(users.length);
      result.data.users.forEach(function (user) {
        expect(user.tasks).length.to.be(1);
      });
    });
  });

  it('should resolve a array result with a single limited hasMany association with a before filter', function () {
    var users = this.users;

    return graphql(schema, `
      {
        users {
          tasks(first: 2) {
            title
          }
        }
      }
    `).then(function (result) {
      if (result.errors) throw new Error(result.errors[0].message);

      expect(result.data.users.length).to.equal(users.length);
      result.data.users.forEach(function (user) {
        expect(user.tasks).length.to.be(2);
      });
    });
  });
});