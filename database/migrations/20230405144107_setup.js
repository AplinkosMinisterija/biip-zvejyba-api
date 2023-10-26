const commonFields = (table) => {
  table.timestamp("createdAt");
  table.integer("createdBy").unsigned();
  table.timestamp("updatedAt");
  table.integer("updatedBy").unsigned();
  table.timestamp("deletedAt");
  table.integer("deletedBy").unsigned();
};

exports.commonFields = commonFields;

exports.up = function (knex) {
  return knex.schema
    .createTable("users", (table) => {
      table.increments("id");
      table.integer("authUserId").unsigned();
      table.string("firstName", 255);
      table.string("lastName", 255);
      table.string("email", 255);
      table.string("phone", 255);
      table.timestamp("lastLogin");
      table.enu("type", ["USER", "ADMIN"]).defaultTo("USER");
      table.jsonb("tenants");
      table.boolean("isFreelancer");
      commonFields(table);
    })
    .createTable("tenants", (table) => {
      table.increments("id");
      table.string("code");
      table.string("email");
      table.string("phone");
      table.string("name", 255);
      table.integer("authGroupId").unsigned();
      commonFields(table);
    })
    .createTable("tenantUsers", (table) => {
      table.increments("id");
      table.integer("tenantId").unsigned();
      table.integer("userId").unsigned();
      table.enu("role", ["USER", "USER_ADMIN", "OWNER"]).defaultTo("USER");
      commonFields(table);
    })
    .createTable("fishTypes", (table) => {
      table.increments("id");
      table.string("label");
      commonFields(table);
    })
    .createTable("fishings", (table) => {
      table.increments("id");
      table.timestamp("startDate");
      table.timestamp("endDate");
      table.timestamp("skipDate");
      table.enu("type", ["ESTUARY", "POLDERS", "INLAND_WATERS"]);
      table.integer("tenantId").unsigned();
      table.integer("userId").unsigned();
      commonFields(table);
    })
    .raw(`CREATE EXTENSION IF NOT EXISTS postgis;`)
    .raw(`ALTER TABLE fishings ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX fishings_geom_idx ON fishings USING GIST (geom)`)
    .createTable("toolTypes", (table) => {
      table.increments("id");
      table.string("label");
      table.enum("type", ["NET", "CATCHER"]);
      commonFields(table);
    })
    .createTable("tools", (table) => {
      table.increments("id");
      table.string("sealNr");
      table.double("eyeSize");
      table.double("eyeSize2");
      table.double("netLength");
      table.integer("toolTypeId").unsigned();
      table.integer("tenantId").unsigned();
      table.integer("userId").unsigned();
      table.integer("toolGroupId").unsigned();
      commonFields(table);
    })
    .createTable("toolGroups", (table) => {
      table.increments("id");
      table.jsonb("tools");
      table.timestamp("startDate");
      table.integer("startFishingId").unsigned();
      table.timestamp("endDate");
      table.integer("endFishingId").unsigned();
      table.integer("tenantId").unsigned();
      table.integer("userId").unsigned();
      table.integer("locationId");
      table.string("locationName");
      table.enu("locationType", ["ESTUARY", "POLDERS", "INLAND_WATERS"]);
      commonFields(table);
    })
    .raw(`ALTER TABLE tool_groups ADD COLUMN geom geometry(point, 3346)`)
    .raw(`CREATE INDEX tool_groups_geom_idx ON tool_groups USING GIST (geom)`);
};

exports.down = function (knex) {
  return knex.schema
    .dropTable("tenantUsers")
    .dropTable("tenants")
    .dropTable("users")
    .dropTable("fishTypes")
    .dropTable("fishings")
    .dropTable("toolTypes")
    .dropTable("tools")
    .dropTable("toolGroups");
};
