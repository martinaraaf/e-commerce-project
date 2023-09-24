import { Router } from 'express'
const router = Router()
import * as rc from './review.controller.js'
import { asyncHandler } from '../../utils/errorhandling.js'
import { multerCloudFunction } from '../../services/multerCloud.js'
import { allowedExtensions } from '../../utils/allowedExtensions.js'
import * as validators from './reviews.validationSchemas.js'
import { validationCoreFunction } from '../../middlewares/validation.js'
import { isAuth } from '../../middlewares/auth.js'
import { reviewApisRoles } from './review.emdPoints.js'

router.post(
  '/',
  isAuth(reviewApisRoles.ADD_REVIEW),
  validationCoreFunction(validators.addReviewSchema),
  asyncHandler(rc.addReview),
)

export default router
