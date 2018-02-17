import * as r from "rethinkdb";
import { NewPooler } from "pooler";

const config = {
  max: 10, // default
  min: 3, // default
  max_retries: 3, // default
  buffer_on_start: true, // default
  async factory() {
    return await r.connect("localhost:8080");
  },
  async destructor(conn) {
    await conn.close();
  },
  async is_ok(conn) {
    if (!conn.open) {
      return false;
    }

    try {
      await conn.ping();
    } catch (error) {
      return false;
    }

    return true;
  },
};

const pool = NewPooler(config);

app.get("/products", async (req, res) => {
  pool.use(async conn => {
    let cursor = await r.table("products").run(conn);
    let products = await cursor.toArray();
    res.json(products);
    res.end();
  });
});
