// Verhalten dieses Features. I/O ist hier erlaubt.
package template

import "PROJEKTNAME/atoms/vorlage/example"

func Handle(value int) (Example, error) {
	v, err := example.Run(value)
	if err != nil {
		return Example{}, err
	}
	return Example{Value: v}, nil
}
