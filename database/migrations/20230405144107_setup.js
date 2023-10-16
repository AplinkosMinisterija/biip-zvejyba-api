const commonFields = (table) => {
  table.timestamp('createdAt');
  table.integer('createdBy').unsigned();
  table.timestamp('updatedAt');
  table.integer('updatedBy').unsigned();
  table.timestamp('deletedAt');
  table.integer('deletedBy').unsigned();
};

exports.commonFields = commonFields;

exports.up = function (knex) {
  return knex.schema
    .createTable('users', (table) => {
      table.increments('id');
      table.integer('authUserId').unsigned();
      table.string('firstName', 255);
      table.string('lastName', 255);
      table.string('email', 255);
      table.string('phone', 255);
      table.timestamp('lastLogin');
      table.enu('type', ['USER', 'ADMIN']).defaultTo('USER');
      table.jsonb('tenants');
      table.boolean('isFreelancer');
      commonFields(table);
    })
    .createTable('tenants', (table) => {
      table.increments('id');
      table.string('code');
      table.string('email');
      table.string('phone');
      table.string('name', 255);
      table.integer('authGroupId').unsigned();
      commonFields(table);
    })
    .createTable('tenantUsers', (table) => {
      table.increments('id');
      table.integer('tenantId').unsigned();
      table.integer('userId').unsigned();
      table.enu('role', ['USER', 'USER_ADMIN', 'OWNER']).defaultTo('USER');
      commonFields(table);
    })
    .createTable('fishTypes', (table) => {
      table.increments('id');
      table.string('label');
      commonFields(table);
    })
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('tenantUsers')
    .dropTable('tenants')
    .dropTable('users')
    .dropTable('fishTypes');
};
