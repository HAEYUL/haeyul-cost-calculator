import express from 'express'
import analyzeInvoiceHandler from '../api/analyze-invoice.js'
import analyzeRecipeHandler from '../api/analyze-recipe.js'
import matchIngredientHandler from '../api/match-ingredient.js'

const app = express()
app.use(express.json({ limit: '15mb' }))

app.post('/api/analyze-invoice', analyzeInvoiceHandler)
app.post('/api/analyze-recipe', analyzeRecipeHandler)
app.post('/api/match-ingredient', matchIngredientHandler)

const port = process.env.API_PORT || 8787
app.listen(port, () => {
  console.log(`[dev-api] listening on http://localhost:${port}`)
})
