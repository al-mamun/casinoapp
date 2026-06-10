const { MongoClient } = require("mongodb");
const { Op } = require("sequelize");

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
const dbName = process.env.MONGODB_DB || process.env.DB_NAME || "betx365";

let client;
let database;
const models = new Map();

function getOperatorName(symbol) {
    if (typeof symbol !== "symbol") return null;
    return Symbol.keyFor(symbol) || symbol.description;
}

function cleanValue(value) {
    if (value && typeof value.toJSON === "function") return value.toJSON();
    return value;
}

function normalizeId(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
        return Number(value);
    }
    return value;
}

function matchesValue(actual, expected) {
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
        const entries = [
            ...Object.entries(expected),
            ...Object.getOwnPropertySymbols(expected).map((s) => [s, expected[s]])
        ];

        for (const [key, value] of entries) {
            const op = getOperatorName(key) || key;
            if (op === "in") {
                if (!value.map(normalizeId).includes(normalizeId(actual))) return false;
            } else if (op === "notIn") {
                if (value.map(normalizeId).includes(normalizeId(actual))) return false;
            } else if (op === "like" || op === "iLike") {
                const pattern = String(value).replace(/%/g, ".*");
                const flags = op === "iLike" ? "i" : "";
                if (!new RegExp(`^${pattern}$`, flags).test(String(actual || ""))) return false;
            } else if (op === "ne") {
                if (normalizeId(actual) === normalizeId(value)) return false;
            } else if (op === "gte") {
                if (!(actual >= value)) return false;
            } else if (op === "gt") {
                if (!(actual > value)) return false;
            } else if (op === "lte") {
                if (!(actual <= value)) return false;
            } else if (op === "lt") {
                if (!(actual < value)) return false;
            } else if (op === "between") {
                if (!(actual >= value[0] && actual <= value[1])) return false;
            } else {
                if (normalizeId(actual) !== normalizeId(value)) return false;
            }
        }
        return true;
    }

    return normalizeId(actual) === normalizeId(expected);
}

function matchesWhere(doc, where = {}) {
    const entries = [
        ...Object.entries(where || {}),
        ...Object.getOwnPropertySymbols(where || {}).map((s) => [s, where[s]])
    ];

    for (const [key, expected] of entries) {
        const op = getOperatorName(key);
        if (op === "or") {
            if (!expected.some((clause) => matchesWhere(doc, clause))) return false;
            continue;
        }
        if (op === "and") {
            if (!expected.every((clause) => matchesWhere(doc, clause))) return false;
            continue;
        }
        if (!matchesValue(doc[key], expected)) return false;
    }

    return true;
}

function canUseMongoQuery(where = {}) {
    const entries = [
        ...Object.entries(where || {}),
        ...Object.getOwnPropertySymbols(where || {}).map((s) => [s, where[s]])
    ];
    return entries.every(([key, expected]) => {
        const op = getOperatorName(key);
        if (op) return false;
        if (expected instanceof Date || expected === null) return true;
        if (Array.isArray(expected)) return false;
        if (!expected || typeof expected !== "object") return true;
        const nested = [
            ...Object.entries(expected),
            ...Object.getOwnPropertySymbols(expected).map((s) => [s, expected[s]])
        ];
        return nested.every(([nestedKey, value]) => {
            const nestedOp = getOperatorName(nestedKey) || nestedKey;
            return ["in", "ne", "gte", "gt", "lte", "lt"].includes(nestedOp) && !(value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date));
        });
    });
}

// Returns true for field names that store integer IDs (id, userId, matchId, etc.)
function isIdLikeField(fieldName) {
    return fieldName === "id" || /Id$|_id$/.test(fieldName);
}

// Expand a single ID value to include both its number and string forms so that
// MongoDB documents seeded with string IDs ("1") and those with number IDs (1)
// are both found by the same query.
function idFilter(value) {
    const num = normalizeId(value);
    if (typeof num === "number" && Number.isInteger(num)) {
        return { $in: [num, String(num)] };
    }
    return num;
}

function toMongoQuery(where = {}) {
    const query = {};
    for (const [key, expected] of Object.entries(where || {})) {
        if (expected instanceof Date || expected === null || !expected || typeof expected !== "object" || Array.isArray(expected)) {
            // For ID-like fields, match both numeric and string-stored values
            query[key] = isIdLikeField(key) ? idFilter(expected) : normalizeId(expected);
            continue;
        }
        const mongoOps = {};
        for (const [nestedKey, value] of [
            ...Object.entries(expected),
            ...Object.getOwnPropertySymbols(expected).map((s) => [s, expected[s]])
        ]) {
            const op = getOperatorName(nestedKey) || nestedKey;
            // Do NOT call normalizeId on $in values — callers may intentionally pass both
            // string and number forms; normalizeId would collapse them to the same type.
            if (op === "in") mongoOps.$in = value;
            if (op === "ne") mongoOps.$ne = normalizeId(value);
            if (op === "gte") mongoOps.$gte = value;
            if (op === "gt") mongoOps.$gt = value;
            if (op === "lte") mongoOps.$lte = value;
            if (op === "lt") mongoOps.$lt = value;
        }
        query[key] = Object.keys(mongoOps).length ? mongoOps : normalizeId(expected);
    }
    return query;
}

function applyAttributes(doc, attributes) {
    if (!attributes) return doc;
    const data = { ...doc };

    if (Array.isArray(attributes)) {
        return attributes.reduce((picked, key) => {
            if (Object.prototype.hasOwnProperty.call(data, key)) picked[key] = data[key];
            return picked;
        }, {});
    }

    if (attributes.exclude) {
        for (const key of attributes.exclude) delete data[key];
    }

    return data;
}

function sortRows(rows, order = []) {
    if (!Array.isArray(order) || order.length === 0) return rows;

    return rows.sort((a, b) => {
        for (const item of order) {
            const [field, direction = "ASC"] = item;
            const av = a[field];
            const bv = b[field];
            if (av === bv) continue;
            const result = av > bv ? 1 : -1;
            return String(direction).toUpperCase() === "DESC" ? -result : result;
        }
        return 0;
    });
}

async function connect() {
    if (database) return database;
    if (!mongoUri) throw new Error("MONGODB_URI is missing in .env");

    client = new MongoClient(mongoUri);
    await client.connect();
    database = client.db(dbName);
    return database;
}

async function getCollection(name) {
    const db = await connect();
    return db.collection(name);
}

async function nextId(collectionName) {
    const db = await connect();
    const counter = await db.collection("_counters").findOneAndUpdate(
        { _id: collectionName },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" }
    );
    return counter.seq;
}

class MongoRecord {
    constructor(model, data) {
        Object.defineProperty(this, "_model", { value: model, enumerable: false });
        Object.assign(this, data);
    }

    toJSON() {
        const data = {};
        for (const [key, value] of Object.entries(this)) {
            if (key !== "_id") data[key] = cleanValue(value);
        }
        return data;
    }

    async save() {
        const now = new Date();
        if (this._model.timestamps) this.updatedAt = now;
        const data = this.toJSON();

        // Build the lookup filter. Priority order:
        //   1. Integer adapter id  → { id: { $in: [num, "num"] } }  (handles string/number mismatch)
        //   2. MongoDB native _id  → { _id: this._id }               (always present on fetched docs)
        //   3. No identifier       → log error and skip (never upsert with unknown key)
        let filter;
        const idNum = normalizeId(this.id);
        if (typeof idNum === "number" && Number.isInteger(idNum)) {
            filter = { id: { $in: [idNum, String(idNum)] } };
        } else if (this._id) {
            // Fallback: use MongoDB's own _id — documents without an adapter 'id' field
            // (seeded data, externally inserted) can still be updated safely this way.
            filter = { _id: this._id };
        } else {
            // No usable key — refuse to upsert a ghost document.
            console.error(`[MongoRecord.save] Skipped: no 'id' or '_id' on ${this._model.name} record`);
            return this;
        }

        // No upsert — save() only updates existing documents.
        // Creating new documents must go through model.create() so they get a proper id.
        await this._model.collection().then((collection) =>
            collection.updateOne(filter, { $set: data })
        );
        return this;
    }

    async reload() {
        const fresh = await this._model.findByPk(this.id);
        if (fresh) Object.assign(this, fresh.toJSON());
        return this;
    }

    async destroy() {
        await this._model.destroy({ where: { id: this.id } });
    }
}

class MongoModel {
    constructor(name, definition, options = {}) {
        this.name = name;
        this.definition = definition || {};
        this.tableName = options.tableName || `${name.toLowerCase()}s`;
        this.timestamps = options.timestamps !== false;
        this.relations = [];
    }

    collection() {
        return getCollection(this.tableName);
    }

    _defaults() {
        const data = {};
        for (const [key, config] of Object.entries(this.definition)) {
            if (config && Object.prototype.hasOwnProperty.call(config, "defaultValue")) {
                data[key] = typeof config.defaultValue === "function" ? config.defaultValue() : config.defaultValue;
            }
        }
        return data;
    }

    _wrap(data, options = {}) {
        if (!data) return null;
        const cleaned = applyAttributes(data, options.attributes);
        return new MongoRecord(this, cleaned);
    }

    async _loadAllRaw() {
        const collection = await this.collection();
        return collection.find({}).toArray();
    }

    async _query(options = {}) {
        const where = options.where || {};
        let rows;
        let count;
        if (canUseMongoQuery(where)) {
            const collection = await this.collection();
            const query = toMongoQuery(where);
            count = await collection.countDocuments(query);
            let cursor = collection.find(query);
            if (Array.isArray(options.order) && options.order.length) {
                const sort = {};
                options.order.forEach(([field, direction = "ASC"]) => {
                    sort[field] = String(direction).toUpperCase() === "DESC" ? -1 : 1;
                });
                cursor = cursor.sort(sort);
            }
            if (options.offset !== undefined) cursor = cursor.skip(Number(options.offset));
            if (options.limit !== undefined) cursor = cursor.limit(Number(options.limit));
            rows = await cursor.toArray();
        } else {
            rows = (await this._loadAllRaw()).filter((doc) => matchesWhere(doc, where));
            rows = sortRows(rows, options.order);
            count = rows.length;
            if (options.offset !== undefined) rows = rows.slice(Number(options.offset));
            if (options.limit !== undefined) rows = rows.slice(0, Number(options.limit));
        }

        const wrapped = rows.map((row) => this._wrap(row, options));
        if (options.include) await this._applyIncludes(wrapped, options.include);

        return { rows: wrapped, count };
    }

    async _applyIncludes(records, include) {
        const includes = Array.isArray(include) ? include : [include];

        for (const inc of includes) {
            const target = inc.model || inc;
            if (!target) continue;
            const alias = inc.as || target.name;

            for (const record of records) {
                let value = null;
                const hasOne = target.relations.find((r) => r.type === "belongsTo" && r.target === this);
                const belongsTo = this.relations.find((r) => r.type === "belongsTo" && r.target === target);
                const many = this.relations.find((r) => r.type === "belongsToMany" && r.target === target);

                if (belongsTo) {
                    value = await target.findByPk(record[belongsTo.foreignKey], inc);
                } else if (hasOne) {
                    value = await target.findOne({ where: { [hasOne.foreignKey]: record.id }, attributes: inc.attributes });
                } else if (many) {
                    const throughRows = await many.through.findAll({ where: { [many.foreignKey]: record.id } });
                    const targetIds = throughRows.map((row) => row[many.otherKey || `${target.name.charAt(0).toLowerCase()}${target.name.slice(1)}Id`]);
                    value = await target.findAll({ where: { id: { [Op.in]: targetIds } }, attributes: inc.attributes });
                } else {
                    value = await target.findOne({ where: { [`${this.name.charAt(0).toLowerCase()}${this.name.slice(1)}Id`]: record.id }, attributes: inc.attributes });
                }

                record[alias] = value;
                if (!inc.as && Array.isArray(value)) record[`${target.name}s`] = value;
            }
        }
    }

    async create(data) {
        const now = new Date();
        const payload = { ...this._defaults(), ...data };
        if (payload.id === undefined || payload.id === null) payload.id = await nextId(this.tableName);
        if (this.timestamps) {
            payload.createdAt = payload.createdAt || now;
            payload.updatedAt = payload.updatedAt || now;
        }

        const collection = await this.collection();
        await collection.insertOne(payload);
        return this._wrap(payload);
    }

    async bulkCreate(rows) {
        const created = [];
        for (const row of rows) created.push(await this.create(row));
        return created;
    }

    async findOne(options = {}) {
        const { rows } = await this._query({ ...options, limit: 1 });
        return rows[0] || null;
    }

    async findByPk(id, options = {}) {
        return this.findOne({ ...options, where: { ...(options.where || {}), id: normalizeId(id) } });
    }

    async findAll(options = {}) {
        const { rows } = await this._query(options);
        return rows;
    }

    async findAndCountAll(options = {}) {
        return this._query(options);
    }

    async count(options = {}) {
        const { count } = await this._query(options);
        return count;
    }

    async update(values, options = {}) {
        const rows = await this.findAll(options);
        for (const row of rows) {
            Object.assign(row, values);
            await row.save();
        }
        return [rows.length];
    }

    async destroy(options = {}) {
        const rows = await this.findAll(options);
        const collection = await this.collection();
        for (const row of rows) {
            const idNum = normalizeId(row.id);
            const filter = (typeof idNum === "number" && Number.isInteger(idNum))
                ? { id: { $in: [idNum, String(idNum)] } }
                : { id: idNum };
            await collection.deleteOne(filter);
        }
        return rows.length;
    }

    async findOrCreate(options = {}) {
        const existing = await this.findOne({ where: options.where });
        if (existing) return [existing, false];
        const created = await this.create({ ...(options.defaults || {}), ...(options.where || {}) });
        return [created, true];
    }

    belongsTo(target, options = {}) {
        this.relations.push({ type: "belongsTo", target, ...options });
    }

    hasMany(target, options = {}) {
        this.relations.push({ type: "hasMany", target, ...options });
    }

    hasOne(target, options = {}) {
        this.relations.push({ type: "hasOne", target, ...options });
    }

    belongsToMany(target, options = {}) {
        this.relations.push({ type: "belongsToMany", target, ...options });
    }
}

module.exports = {
    define(name, definition, options) {
        const model = new MongoModel(name, definition, options);
        models.set(name, model);
        return model;
    },
    async authenticate() {
        const db = await connect();
        await db.command({ ping: 1 });
    },
    async sync() {
        await connect();
    },
    async transaction() {
        return {
            async commit() {},
            async rollback() {}
        };
    },
    model(name) {
        return models.get(name);
    },
    models,
    nextId,
    close() {
        return client ? client.close() : Promise.resolve();
    }
};
