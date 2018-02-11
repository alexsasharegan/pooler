const { NewPooler } = require("pooler");

const pool_options = {
  max: 10, // default
  min: 3, // default
  max_retries: 3, // default
  buffer_on_start: true, // default
  async factory() {
    return await Database.connect("localhost:8080");
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

const pool = NewPooler(pool_options);

app.get("/products", async (req, res) => {
  pool.use(async conn => {
    let products = await conn.table("products").all();
    res.json(products);
    res.end();
  });
});
