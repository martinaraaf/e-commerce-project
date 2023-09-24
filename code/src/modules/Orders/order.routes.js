import { Router } from 'express'
const router = Router()

import * as oc from './order.controller.js'
import { isAuth } from '../../middlewares/auth.js'
import { asyncHandler } from '../../utils/errorhandling.js'
import { validationCoreFunction } from '../../middlewares/validation.js'
import { createOrderSchema } from './order.validationSchemas.js'
import { systemRoles } from '../../utils/systemRoles.js'
import { orderApisRoles } from './order.endPoints.js'

router.post(
  '/',
  isAuth([systemRoles.USER]),
  validationCoreFunction(createOrderSchema),
  asyncHandler(oc.createOrder),
)

router.post(
  '/cartToOrder',
  isAuth([systemRoles.USER]),
  asyncHandler(oc.fromCartToOrde),
)

router.get('/successOrder', asyncHandler(oc.successPayment))
router.patch('/cancelOrder', asyncHandler(oc.cancelPayment))

router.post(
  '/delivere',
  isAuth(orderApisRoles.DELIVERE_ORDER),
  asyncHandler(oc.deliverOrder),
)

export default router
