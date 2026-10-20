import express from 'express'
import analyzeInvoiceHandler from '../api/analyze-invoice.js'
import analyzeRecipeHandler from '../api/analyze-recipe.js'
import analyzeSettlementHandler from '../api/analyze-settlement.js'
import matchIngredientHandler from '../api/match-ingredient.js'
import analyzeStaffScheduleHandler from '../api/analyze-staff-schedule.js'
import askQuestionHandler from '../api/ask-question.js'
import loginHandler from '../api/login.js'
import changePinHandler from '../api/change-pin.js'
import settlementPinHandler from '../api/settlement-pin.js'

const app = express()
app.use(express.json({ limit: '15mb' }))

app.post('/api/analyze-invoice', analyzeInvoiceHandler)
app.post('/api/analyze-recipe', analyzeRecipeHandler)
app.post('/api/analyze-settlement', analyzeSettlementHandler)
app.post('/api/match-ingredient', matchIngredientHandler)
app.post('/api/analyze-staff-schedule', analyzeStaffScheduleHandler)
app.post('/api/ask-question', askQuestionHandler)
app.post('/api/login', loginHandler)
app.post('/api/change-pin', changePinHandler)
app.post('/api/settlement-pin', settlementPinHandler)

const port = process.env.API_PORT || 8787
app.listen(port, () => {
  console.log(`[dev-api] listening on http://localhost:${port}`)
})
