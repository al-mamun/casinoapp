const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('samir_hosen', 'dbpbf34975162', 's1VX1@n+rRa0m5kllYQvFZ02', {
    host: 'serverless-northeurope.sysp0000.db3.skysql.com',
    port: 4026,
    dialect: 'mysql',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    }
});

sequelize.authenticate()
    .then(() => console.log('Connected!'))
    .catch(err => console.error('Error:', err));