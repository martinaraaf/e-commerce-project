
import Joi from 'joi'
import { generalFields } from '../../middlewares/validation.js'

export const createOrderSchema = {
  body: Joi.object({
    address: Joi.string().required(),
    phoneNumbers: Joi.array().items(Joi.string().required()).required(),
    productId: generalFields._id.required(),
    quantity: Joi.number().positive().integer().min(1).required(),
    paymentMethod: Joi.string().required(),
    couponCode: Joi.string().optional(),
  }).required(),
  headers: Joi.object({
    // host: Joi.string().required(),
    authorization: Joi.string().required(),
  })
    .required()
    .unknown(),
  //   .options({ allowUnknown: true }),
}
